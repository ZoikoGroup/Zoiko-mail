"use client";

import {
  ClipboardEvent,
  KeyboardEvent,
  useEffect,
  useRef,
} from "react";

interface OtpInputProps {
  value: string;
  length?: number;
  disabled?: boolean;
  onChange: (value: string) => void;
}

export default function OtpInput({
  value,
  onChange,
  length = 6,
  disabled = false,
}: OtpInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handleChange = (
    index: number,
    digit: string
  ) => {
    if (!/^\d?$/.test(digit)) return;

    const otp = value.split("");

    otp[index] = digit;

    const newOtp = otp.join("");

    onChange(newOtp);

    if (digit && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (
    e: KeyboardEvent<HTMLInputElement>,
    index: number
  ) => {
    if (
      e.key === "Backspace" &&
      !value[index] &&
      index > 0
    ) {
      inputRefs.current[index - 1]?.focus();
    }

    if (
      e.key === "ArrowLeft" &&
      index > 0
    ) {
      inputRefs.current[index - 1]?.focus();
    }

    if (
      e.key === "ArrowRight" &&
      index < length - 1
    ) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (
    e: ClipboardEvent<HTMLInputElement>
  ) => {
    e.preventDefault();

    const pasted =
      e.clipboardData
        .getData("text")
        .replace(/\D/g, "")
        .slice(0, length);

    if (!pasted) return;

    onChange(pasted);

    requestAnimationFrame(() => {
      const nextIndex =
        pasted.length >= length
          ? length - 1
          : pasted.length;

      inputRefs.current[nextIndex]?.focus();
    });
  };

  return (
    <div className="flex justify-center gap-3">
      {Array.from({ length }).map((_, index) => (
        <input
          key={index}
          ref={(el) => {
            inputRefs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          autoComplete="one-time-code"
          disabled={disabled}
          value={value[index] ?? ""}
          onPaste={handlePaste}
          onKeyDown={(e) =>
            handleKeyDown(e, index)
          }
          onChange={(e) =>
            handleChange(index, e.target.value)
          }          className=" h-10 w-10
            md:h-12
            md:w-12
            rounded-xl
            border
            border-slate-300
            bg-white
            text-center
            text-lg
            md:text-xl
            font-semibold
            text-slate-900
            outline-none
            transition-all
            duration-200

            focus:border-teal-500
            focus:ring-2
            focus:ring-teal-500

            disabled:cursor-not-allowed
            disabled:opacity-60

            dark:border-slate-700
            dark:bg-slate-900
            dark:text-white
            dark:focus:border-teal-400
            dark:focus:ring-teal-400
          "
        />
      ))}
    </div>
  );
}