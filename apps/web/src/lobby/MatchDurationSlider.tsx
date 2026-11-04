interface MatchDurationSliderProps {
  id: string;
  label: string;
  valueMinutes: number;
  minimumMinutes: number;
  maximumMinutes: number;
  disabled?: boolean;
  onChange: (minutes: number) => void;
}

export function getDurationMarks(minimumMinutes: number, maximumMinutes: number): number[] {
  return Array.from(
    { length: Math.floor((maximumMinutes - minimumMinutes) / 5) + 1 },
    (_, index) => minimumMinutes + index * 5,
  );
}

export function MatchDurationSlider({
  id,
  label,
  valueMinutes,
  minimumMinutes,
  maximumMinutes,
  disabled = false,
  onChange,
}: MatchDurationSliderProps) {
  const marks = getDurationMarks(minimumMinutes, maximumMinutes);

  return <div className={`match-duration-field ${disabled ? "is-disabled" : ""}`}>
    <label className="field-label" htmlFor={id}>{label}</label>
    <div className="duration-slider-heading">
      <output className="duration-slider-value" htmlFor={id}>{valueMinutes} minutes</output>
      <span id={`${id}-step-note`}>5-minute steps</span>
    </div>
    <input
      id={id}
      className="duration-slider"
      type="range"
      min={minimumMinutes}
      max={maximumMinutes}
      step={5}
      value={valueMinutes}
      disabled={disabled}
      aria-label={label}
      aria-valuetext={`${valueMinutes} minutes`}
      aria-describedby={`${id}-step-note`}
      onChange={(event) => onChange(Number(event.target.value))}
    />
    <div className="duration-slider-scale" aria-hidden="true">
      {marks.map((minute) => <span key={minute}>{minute}</span>)}
    </div>
  </div>;
}
