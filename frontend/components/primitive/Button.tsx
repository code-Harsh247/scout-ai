import { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary:   "bg-brand-500 text-white hover:bg-brand-600",
  secondary: "bg-muted text-text border border-border hover:bg-border",
  danger:    "bg-danger text-white hover:opacity-90",
  ghost:     "bg-transparent text-text-sub hover:text-text hover:bg-muted",
};

const sizeClasses: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

export default function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`
        inline-flex items-center justify-center font-medium rounded-[var(--radius-md)]
        transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed
        ${variantClasses[variant]} ${sizeClasses[size]} ${className}
      `.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
