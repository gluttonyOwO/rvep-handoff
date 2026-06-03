import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "xl";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const base =
  "inline-flex items-center justify-center gap-2 font-medium rounded-full select-none " +
  "transition-[transform,background,border-color,opacity] duration-150 active:scale-[0.98] " +
  "disabled:opacity-40 disabled:cursor-not-allowed";

const variants: Record<Variant, string> = {
  primary:
    "bg-white text-black hover:bg-neutral-200",
  secondary:
    "surface surface-hover text-neutral-100",
  ghost:
    "text-neutral-400 hover:text-white",
  danger:
    "bg-[var(--accent-red)] text-white hover:bg-[var(--accent-red-dim)] shadow-[0_0_30px_rgba(227,25,55,0.3)]",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-13 px-6 text-base",
  xl: "h-16 px-8 text-lg",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", size = "md", className = "", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    />
  );
});
