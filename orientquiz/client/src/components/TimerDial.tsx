import React, { useEffect, useState } from "react";

interface TimerDialProps {
  deadline: number; // Server deadline timestamp in ms
  totalSeconds: number; // Total timer seconds for this question
  isPaused?: boolean;
  onExpire?: () => void;
}

export const TimerDial: React.FC<TimerDialProps> = ({
  deadline,
  totalSeconds,
  isPaused = false,
  onExpire,
}) => {
  const [remainingMs, setRemainingMs] = useState<number>(() => {
    return Math.max(0, deadline - Date.now());
  });

  useEffect(() => {
    if (isPaused) return;

    const interval = setInterval(() => {
      const remaining = Math.max(0, deadline - Date.now());
      setRemainingMs(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
        onExpire?.();
      }
    }, 50);

    return () => clearInterval(interval);
  }, [deadline, isPaused, onExpire]);

  const totalMs = totalSeconds * 1000;
  const fractionRemaining = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
  const secondsDisplay = Math.ceil(remainingMs / 1000);

  // SVG circular geometry
  const size = 160;
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  // Depletes clockwise (dashoffset increases from 0 to circumference)
  const strokeDashoffset = circumference * (1 - fractionRemaining);

  return (
    <div className="relative flex items-center justify-center mx-auto my-4" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        className="transform -rotate-90"
        viewBox={`0 0 ${size} ${size}`}
      >
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#E5E7EB"
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        {/* Active stopwatch bezel progress ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={isPaused ? "#6B7280" : secondsDisplay <= 5 ? "#DC2626" : "#4F46E5"}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="transparent"
          className="transition-all duration-75 ease-linear"
        />
      </svg>

      {/* Hero Digits inside Dial */}
      <div className="absolute inset-0 flex flex-col items-center justify-center select-none">
        <span
          className={`font-mono text-5xl font-bold tracking-tighter ${
            isPaused
              ? "text-muted"
              : secondsDisplay <= 5
              ? "text-danger"
              : "text-ink"
          }`}
          style={{ fontSize: "56px" }}
        >
          {secondsDisplay}
        </span>
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted mt-0.5">
          {isPaused ? "PAUSED" : "SECONDS"}
        </span>
      </div>
    </div>
  );
};
