import { classNames } from "./classNames";

export type SkeletonProps = {
  bars?: 2 | 3;
  className?: string;
};

export function Skeleton({ bars = 3, className }: SkeletonProps) {
  return (
    <div aria-hidden="true" className={classNames("motion-skeleton grid gap-ui-8", className)}>
      {Array.from({ length: bars }, (_, index) => (
        <span
          key={index}
          className={classNames(
            "motion-skeleton__bar",
            index === bars - 1 ? "motion-skeleton__bar--short" : undefined,
          )}
        />
      ))}
    </div>
  );
}
