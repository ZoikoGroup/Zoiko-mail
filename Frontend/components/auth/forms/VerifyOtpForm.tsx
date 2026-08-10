"use client";

// import { useEffect, useState } from "react";
import { useEffect, useState } from "react";

import {
  useVerifyOtp,
  useResendOtp,
} from "@/lib/auth-hooks";

import { ApiError } from "@/lib/api-client";
import { HiArrowLeft } from "react-icons/hi";
import { MdEmail } from "react-icons/md";

import OtpInput from "../inputs/OtpInput";

// interface VerifyOtpFormProps {
//   token: string;
//   onBack: () => void;
//   onSuccess: (token: string) => void;
// }
interface VerifyOtpFormProps {
  token: string;
  email: string;
  onBack: () => void;
  onSuccess: (token: string) => void;
}

export default function VerifyOtpForm({
  token,
  email,
  onBack,
  onSuccess,
}: VerifyOtpFormProps) {
  const [otp, setOtp] = useState("");

  const [seconds, setSeconds] = useState(120);

  const verifyMutation = useVerifyOtp();

  const resendMutation = useResendOtp();

  const [error, setError] = useState("");

  useEffect(() => {
    if (seconds === 0) return;

    const timer = setInterval(() => {
      setSeconds((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [seconds]);

  // useEffect(() => {
  //   if (otp.length === 6 && !verifyMutation.isPending) {
  //     verifyOtp();
  //   }
  // }, [otp]);

  // const verifyOtp = async () => {
  //   if (otp.length !== 6) {
  //     setError("Please enter the 6 digit OTP.");
  //     return;
  //   }

  //   try {
  //     setError("");


  //     const response = await fetch(
  //       "/api/v1/auth/verify-otp",
  //       {
  //         method: "POST",

  //         headers: {
  //           Authorization: `Bearer ${token}`,
  //           "Content-Type":
  //             "application/json",
  //         },

  //         body: JSON.stringify({
  //           code: otp,
  //         }),
  //       }
  //     );

  //     const data = await response.json();

  //     if (!response.ok) {
  //       throw new Error(
  //         data?.message ??
  //           "Verification failed."
  //       );
  //     }

  //     onSuccess(
  //       data.data.pendingToken
  //     );
  //   } catch (err) {
  //     setError(
  //       err instanceof Error
  //         ? err.message
  //         : "Something went wrong."
  //     );
  //   } finally {

  //   }
  // };
  const verifyOtp = () => {
    if (otp.length !== 6) {
      setError("Please enter the 6 digit verification code.");
      return;
    }

    setError("");

    // verifyMutation.mutate(
    //   {
    //     token,
    //     code: otp,
    //   },
    //   {
    //     onSuccess: (response) => {
    //       onSuccess(response.data.pendingToken);
    //     },

    //     onError: (error) => {
    //       setError(
    //         error instanceof ApiError
    //           ? error.message
    //           : "Unable to verify OTP."
    //       );
    //     },
    //   }
    // );
    verifyMutation.mutate(
      {
        token,
        code: otp,
      },
      {
        // onSuccess: (response) => {
        //   const pendingToken = response?.pendingToken;

        //   if (typeof pendingToken === "string") {
        //     onSuccess(pendingToken);
        //   } else {
        //     setError("Unable to verify your verification code.");
        //   }
        // },
        onSuccess: (response) => {
          setError("");

          const nextToken =
            (response as any)?.pendingToken ??
            (response as any)?.data?.pendingToken ??
            token;

          onSuccess(nextToken); // moves OTP screen -> Create workspace step
        },

        onError: (error) => {
          setError(
            error instanceof ApiError
              ? error.message
              : "Unable to verify your verification code."
          );
        },
      }
    );
  };

  const resendOtp = () => {
    resendMutation.mutate(
      {
        token,
      },
      {
        onSuccess: () => {
          setSeconds(120);
        },

        onError: (error) => {
          setError(
            error instanceof ApiError
              ? error.message
              : "Unable to resend verification code."
          );
        },
      }
    );
  };

  return (
    <>
      {/* ==========================================
            HEADER
      =========================================== */}

      <button
        onClick={onBack}
        className="mb-6 flex items-center gap-2 text-sm text-slate-500 transition hover:text-teal-600 dark:text-slate-400 dark:hover:text-teal-400"
      >
        <HiArrowLeft />

        Back
      </button>

      <div className="mb-8 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/40">
          <MdEmail className="text-3xl text-teal-600 dark:text-teal-400" />
        </div>

        <h2 className=" text-2xl md:text-3xl font-bold text-slate-900 dark:text-white">
          Verify your email
        </h2>

        <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
          We sent a 6-digit verification code to
        </p>

        <p className="mt-2 font-semibold text-slate-900 dark:text-white">
          {email}
        </p>
      </div>

      <div className="space-y-6">
        <OtpInput
          value={otp}
          onChange={(value) => {
            setOtp(value);
            if (error) {
              setError("");
            }
          }}
        />
        {/* ==========================================
            Error Message
        =========================================== */}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {/* ==========================================
            Verify Button
        =========================================== */}

        <button
          type="button"
          onClick={verifyOtp}
          disabled={
            verifyMutation.isPending ||
            otp.length !== 6
          }
          className="flex h-12 w-full items-center justify-center rounded-xl bg-teal-600 text-sm font-semibold text-white transition-all duration-300 hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {verifyMutation.isPending
            ? "Verifying..."
            : "Verify Code"}
        </button>

        {/* ==========================================
            Resend Section
        =========================================== */}

        <div className="text-center">
          {seconds > 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Didn't receive the code?
              <br />

              <span className="mt-1 inline-block font-semibold text-teal-600 dark:text-teal-400">
                Resend available in {seconds}s
              </span>
            </p>
          ) : (
            <button
              type="button"
              onClick={resendOtp}
              disabled={resendMutation.isPending}
              className="text-sm font-semibold text-teal-600 transition hover:text-teal-700 disabled:opacity-60 dark:text-teal-400 dark:hover:text-teal-300"
            >
              {resendMutation.isPending
                ? "Sending..."
                : "Resend Verification Code"}
            </button>
          )}
        </div>

        {/* ==========================================
            Information Box
        =========================================== */}

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
          <p className="text-center text-sm leading-6 text-slate-600 dark:text-slate-300">
            Please check your inbox and spam folder for
            the verification email. The code expires after
            a short period for security reasons.
          </p>
        </div>       
         {/* ==========================================
            Change Email
        =========================================== */}

        <div className="text-center">
          <button
            type="button"
            onClick={onBack}
            className="text-sm font-medium text-teal-600 transition hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300"
          >
            ← Change email address
          </button>
        </div>

        {/* ==========================================
            Help Text
        =========================================== */}

        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/40 dark:bg-blue-950/20">
          <h3 className="mb-2 text-sm font-semibold text-blue-700 dark:text-blue-300">
            Having trouble?
          </h3>

          <ul className="space-y-2 text-sm leading-6 text-blue-700 dark:text-blue-200">
            <li>• Check your spam or junk folder.</li>
            <li>• Make sure you entered the correct email address.</li>
            <li>• Wait until the countdown finishes before requesting another code.</li>
            <li>• Each verification code can only be used once.</li>
          </ul>
        </div>

        {/* ==========================================
            Footer
        =========================================== */}

        <div className="border-t border-slate-200 pt-6 dark:border-slate-700">
          <p className="text-center text-xs leading-6 text-slate-500 dark:text-slate-500">
            By continuing you agree to our{" "}
            <a
              href="/terms"
              className="font-medium text-teal-600 hover:underline dark:text-teal-400"
            >
              Terms of Service
            </a>{" "}
            and{" "}
            <a
              href="/privacy"
              className="font-medium text-teal-600 hover:underline dark:text-teal-400"
            >
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </div>
    </>
  );
}