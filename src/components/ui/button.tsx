import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-transparent text-sm font-semibold whitespace-nowrap select-none outline-none transition-[transform,box-shadow,background-color,color,border-color] duration-300 ease-soft focus-visible:ring-4 focus-visible:ring-ball/60 active:not-aria-[haspopup]:scale-[0.97] active:duration-100 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-soft hover:-translate-y-0.5 hover:shadow-lift [&_svg]:transition-transform [&_svg]:duration-300 [&_svg]:ease-soft hover:[&_svg:last-child]:translate-x-0.5",
        outline:
          "border-border bg-card text-foreground hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-soft",
        secondary: "bg-secondary text-secondary-foreground hover:bg-muted",
        ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground",
        destructive: "bg-destructive text-white hover:-translate-y-0.5 hover:shadow-soft",
        link: "rounded-sm px-0 text-foreground underline decoration-foreground/30 decoration-1 underline-offset-4 hover:decoration-foreground",
      },
      size: {
        default: "h-10 px-5",
        xs: "h-7 px-2.5 text-xs",
        sm: "h-8 px-3.5 text-[0.82rem]",
        lg: "h-12 px-7 text-[0.95rem]",
        icon: "size-10",
        "icon-xs": "size-7",
        "icon-sm": "size-8",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
