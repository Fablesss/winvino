import type { ButtonHTMLAttributes } from "react";

const VARIANT_CLASSES = {
  primary: "bg-action text-action-ink min-h-14 px-6 text-[1.0625rem] font-semibold active:opacity-85",
  secondary: "text-link min-h-12 px-4 text-base font-medium active:opacity-70",
} as const;

type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant: keyof typeof VARIANT_CLASSES };

export function ActionButton({ variant, className = "", type = "button", ...buttonProps }: ActionButtonProps) {
  return (
    <button
      type={type}
      className={`w-full rounded-2xl transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action ${VARIANT_CLASSES[variant]} ${className}`}
      {...buttonProps}
    />
  );
}
