"""Vehicle Adapter abstract layer — separates vehicle-specific motor control
from the generic RVEP bridge plumbing (LiveKit DataChannel + safety + telemetry).

A new vehicle / drivetrain only needs to implement VehicleAdapter; the bridge
core (main.py, watchdog, telemetry loop) stays unchanged.

Spec: openspec/control/vehicle-adapter.md
      project_rv2_csm_integration_plan memory
      project_rvep_telemetry_architecture memory

Status: 2026-05-24 — first version covers movement + emergency_stop.
Telemetry subscribers (odom / battery / imu) will move into adapters in a
later iteration; for now they remain in main.py keyed by vehicle type.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from rclpy.node import Node


class VehicleAdapter(ABC):
    """Abstract base for vehicle-side motor control adapters.

    Implementations translate normalised operator-frame axes
    (forward / lateral / yaw, each in [-1, 1]) to the vehicle's specific
    ROS2 topic + message + scaling. They also own the ROS2 publishers they
    need (created in ``init_publishers``).
    """

    #: Human-readable vehicle type label (matches DB ``Vehicle.adapterType``).
    name: str = "abstract"

    @abstractmethod
    def init_publishers(self, node: "Node") -> None:
        """Create the ROS2 publishers this adapter needs. Called once by the
        bridge after the rclpy Node is constructed."""

    @abstractmethod
    def publish_movement(self, forward: float, lateral: float, yaw: float) -> None:
        """Translate normalised axes (-1..1) → vehicle-specific cmd_vel-like
        message → publish to motor controller(s)."""

    @abstractmethod
    def publish_emergency_stop(self) -> None:
        """Immediate zero-velocity stop. Should be safe to call any time
        (no preconditions). Publishes to whatever topics keep the vehicle still."""

    def capabilities(self) -> list[str]:
        """Edge advertisement: ``capabilities`` field added to first telemetry
        frame. Cockpit uses this to decide which UI widgets to mount.
        Default = motion-only; subclasses extend."""
        return ["movement"]


class WheeltecAMRAdapter(VehicleAdapter):
    """Diff-drive AMR (R2 — Wheeltec ROS2 base) using geometry_msgs/Twist.

    Publishes to /rvep/cmd_vel (always — for CSM Source visibility) and
    optionally /cmd_vel directly (mirror mode, demo path that bypasses
    twist_mux due to QoS bug — see project_r2_twist_mux_qos_root_cause).
    """

    name = "wheeltec_amr"

    # Conservative limits for indoor R2 demo. Override via env in main.py if
    # different chassis needs more speed.
    MAX_LINEAR_MS = 0.6   # forward / lateral m/s at full stick
    MAX_ANGULAR_RADS = 1.5  # yaw rad/s at full stick

    def __init__(
        self,
        publish_mode: str = "mirror",
        max_linear_ms: float | None = None,
        max_angular_rads: float | None = None,
    ) -> None:
        if publish_mode not in ("mirror", "csm"):
            raise ValueError(f"publish_mode must be 'mirror' or 'csm', got {publish_mode!r}")
        self.publish_mode = publish_mode
        if max_linear_ms is not None:
            self.MAX_LINEAR_MS = max_linear_ms
        if max_angular_rads is not None:
            self.MAX_ANGULAR_RADS = max_angular_rads

        self._cmd_pub = None         # /cmd_vel (only in mirror mode)
        self._rvep_cmd_pub = None    # /rvep/cmd_vel (always)
        self._stop_pub = None        # /rvep/emergency_stop

    def init_publishers(self, node: "Node") -> None:
        from geometry_msgs.msg import Twist
        self._rvep_cmd_pub = node.create_publisher(Twist, "/rvep/cmd_vel", 10)
        self._stop_pub = node.create_publisher(Twist, "/rvep/emergency_stop", 10)
        if self.publish_mode == "mirror":
            self._cmd_pub = node.create_publisher(Twist, "/cmd_vel", 10)

    def publish_movement(self, forward: float, lateral: float, yaw: float) -> None:
        from geometry_msgs.msg import Twist
        msg = Twist()
        msg.linear.x = forward * self.MAX_LINEAR_MS
        msg.linear.y = lateral * self.MAX_LINEAR_MS
        msg.angular.z = yaw * self.MAX_ANGULAR_RADS
        self._rvep_cmd_pub.publish(msg)
        if self._cmd_pub is not None:
            self._cmd_pub.publish(msg)

    def publish_emergency_stop(self) -> None:
        from geometry_msgs.msg import Twist
        zero = Twist()  # all fields default 0
        self._stop_pub.publish(zero)
        self._rvep_cmd_pub.publish(zero)
        if self._cmd_pub is not None:
            self._cmd_pub.publish(zero)

    def capabilities(self) -> list[str]:
        # Demo subset; telemetry caps still advertised by RosPublisher core.
        return ["movement", "wheels", "twist_cmd_vel"]
