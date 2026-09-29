import type { ButtonHTMLAttributes } from "react";

/** Размеры и цвета кнопок vino-svoe.ru: primary — large (56px, радиус 16), secondary — текстовая ссылка. */
const VARIANT_CLASSES = {
  primary: "min-h-14 rounded-2xl bg-action px-4 text-action-ink hover:bg-action-hover",
  secondary: "min-h-11 rounded-xl px-4 text-link hover:text-action-hover",
} as const;

type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant: keyof typeof VARIANT_CLASSES };

export function ActionButton({ variant, className = "", type = "button", ...buttonProps }: ActionButtonProps) {
  return (
    <button
      type={type}
      className={`flex w-full items-center justify-center text-base font-semibold transition-[background-color,color,transform] duration-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action ${VARIANT_CLASSES[variant]} ${className}`}
      {...buttonProps}
    />
  );
}
