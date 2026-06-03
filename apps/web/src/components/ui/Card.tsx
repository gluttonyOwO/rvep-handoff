import { HTMLAttributes } from "react";

export function Card({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`surface rounded-[var(--radius-lg)] ${className}`}
      {...rest}
    />
  );
}

export function CardButton({
  className = "",
  ...rest
}: HTMLAttributes<HTMLButtonElement> & { onClick?: () => void }) {
  return (
    <button
      className={`surface surface-hover rounded-[var(--radius-lg)] text-left w-full ${className}`}
      {...rest}
    />
  );
}
