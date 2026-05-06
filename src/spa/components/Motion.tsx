import {
  AnimatePresence,
  type HTMLMotionProps,
  motion,
  useReducedMotion,
} from "framer-motion";
import { forwardRef, type ReactNode } from "react";

export const layoutTransition = {
  type: "spring",
  stiffness: 520,
  damping: 46,
  mass: 0.85,
} as const;

export const fadeTransition = {
  duration: 0.16,
  ease: [0.2, 0, 0, 1],
} as const;

export const expandTransition = {
  duration: 0.22,
  ease: [0.2, 0, 0, 1],
} as const;

type MotionSurfaceProps = {
  children: ReactNode;
  className?: string;
  layoutId?: string;
} & Omit<HTMLMotionProps<"div">, "children" | "className" | "layoutId">;

export const MotionSurface = forwardRef<HTMLDivElement, MotionSurfaceProps>(
  ({ children, className, layoutId, ...props }, ref) => (
    <motion.div
      layout="position"
      layoutId={layoutId}
      ref={ref}
      transition={layoutTransition}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  ),
);
MotionSurface.displayName = "MotionSurface";

type MotionRowProps = MotionSurfaceProps & {
  "data-row"?: boolean;
};

export const MotionRow = forwardRef<HTMLDivElement, MotionRowProps>(
  ({ children, className, layoutId, "data-row": dataRow, ...props }, ref) => (
    <motion.div
      layout="position"
      layoutId={layoutId}
      data-row={dataRow ? true : undefined}
      ref={ref}
      transition={layoutTransition}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  ),
);
MotionRow.displayName = "MotionRow";

type FadeInProps = {
  children: ReactNode;
  className?: string;
};

export const FadeIn = ({ children, className }: FadeInProps) => {
  const reducedMotion = useReducedMotion();

  if (reducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={fadeTransition}
      className={className}
    >
      {children}
    </motion.div>
  );
};

type ExpandableRegionProps = {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  isOpen: boolean;
};

export const ExpandableRegion = ({
  children,
  className,
  innerClassName,
  isOpen,
}: ExpandableRegionProps) => {
  const reducedMotion = useReducedMotion();

  if (reducedMotion) {
    return isOpen ? <div className={className}>{children}</div> : null;
  }

  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          key="body"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={expandTransition}
          className={className}
        >
          <div className={innerClassName}>{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
