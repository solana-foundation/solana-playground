import {
  ComponentPropsWithoutRef,
  Dispatch,
  FocusEvent,
  forwardRef,
  SetStateAction,
} from "react";
import { PgView } from "../../utils";
import { cn } from "@/shared/lib/utils";

type InputError = string | boolean | null;

export interface InputProps extends ComponentPropsWithoutRef<"input"> {
  value: string;
  error?: InputError;
  setError?: Dispatch<SetStateAction<any>>;
  validator?: (value: string) => boolean | void;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, setError, onChange, validator, ...props }, ref) => (
    <>
      {typeof error === "string" && error && (
        <div className="mb-2 text-[0.75rem] text-error">{error}</div>
      )}
      <input
        ref={ref}
        {...defaultInputProps}
        {...props}
        className={cn(
          "h-8 w-full rounded-[12px] border border-border bg-surface-raised px-3 py-[0.4375rem] text-[0.8125rem] font-normal text-[var(--text-primary)] shadow-none",
          "focus:outline focus:outline-1 focus:outline-[color-mix(in_srgb,var(--primary)_39%,transparent)]",
          "disabled:cursor-not-allowed disabled:bg-muted disabled:text-[var(--text-secondary)]",
          "[&.error]:border-error [&.success]:border-success",
          className,
          error && PgView.classNames.ERROR
        )}
        onChange={(ev) => {
          const handleError = (err: InputError) => {
            if (setError) setError(err);

            if (err) ev.target.classList.add(PgView.classNames.ERROR);
            else ev.target.classList.remove(PgView.classNames.ERROR);
          };

          // Reset error if possible
          handleError(null);

          // Validation
          if (validator) {
            try {
              if (validator(ev.target.value) === false) handleError(true);
            } catch (err: any) {
              handleError(err.message);
            }
          }

          onChange?.(ev);
        }}
      />
    </>
  )
);

const defaultInputProps = {
  autoComplete: "off",
  onFocus: (e: FocusEvent<HTMLInputElement>) => {
    e.target.classList.add(PgView.classNames.TOUCHED);
  },
};

export default Input;
