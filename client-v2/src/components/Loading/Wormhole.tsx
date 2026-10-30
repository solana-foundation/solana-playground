import { FC } from "react";

// in rem
const DEFAULT_SIZE = 3;
const DEFAULT_CIRCLE_COUNT = 8;

interface WormholeProps {
  size?: number;
  circleCount?: number;
}

export const Wormhole: FC<React.PropsWithChildren<WormholeProps>> = ({
  size = DEFAULT_SIZE,
  circleCount = DEFAULT_CIRCLE_COUNT,
}) => {
  return (
    <div className="flex w-full items-center justify-center">
      <div
        className="relative"
        style={{ width: `${size}rem`, height: `${size}rem` }}
      >
        {Array(circleCount)
          .fill(1)
          .map((v, i) => v + i)
          .map((number) => (
            <span
              key={number}
              className="absolute rounded-full border-2 border-primary border-y-transparent [animation:pg-wormhole_1s_linear_infinite] [transition:all_2s_ease_0s]"
              style={{
                height: `${size * (1 - number / 10)}rem`,
                width: `${size * (1 - number / 10)}rem`,
                top: `${number * 0.7 * 2.5}%`,
                left: `${number * 0.35 * 2.5}%`,
                animationDelay: `${(number * 0.2) / 1}s`,
              }}
            />
          ))}
      </div>
    </div>
  );
};
