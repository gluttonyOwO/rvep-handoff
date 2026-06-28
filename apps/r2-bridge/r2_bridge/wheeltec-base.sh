#!/usr/bin/env bash
# Wheeltec R2 base controller launcher — driven by systemd r2-wheeltec-base.service.
# Sources both ROS2 jazzy runtime + the customer-built wheeltec workspace,
# then exec's the launch.py that brings up the motor controller + LiDAR + TF tree.
#
# Why a wrapper instead of inlining in ExecStart:
# - systemd's ExecStart=bash -lc '...' sometimes fails to propagate source'd env
#   to ros2 launch's spawned children. A real script with explicit sourcing is
#   more deterministic.
# - launch.py is at /home/playrobot/Desktop, not relocatable (built-in package
#   share paths are hardcoded after colcon build).

set -e

# ROS2 jazzy core
source /opt/ros/jazzy/setup.bash

# Wheeltec-built workspace (huanyu_robot_start + sllidar_ros2 + huanyubot_description ...)
source /home/playrobot/Desktop/robot_ws/robot_ws/install/setup.bash

cd /home/playrobot/Desktop/2024_AMR_pro/playrobot_robot_nav

exec ros2 launch ./robot_start.launch.py
