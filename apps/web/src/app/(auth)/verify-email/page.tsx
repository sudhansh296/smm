"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api, getErrorMessage } from "@/lib/api";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Invalid verification link");
      return;
    }
    api.post("/auth/verify-email", { token })
      .then(() => { setStatus("success"); setMessage("Email verified! You can now log in."); })
      .catch((err) => { setStatus("error"); setMessage(getErrorMessage(err)); });
  }, [token]);

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle>Email Verification</CardTitle>
      </CardHeader>
      <CardContent className="text-center space-y-4">
        {status === "loading" && (
          <div className="flex justify-center">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        )}
        {status === "success" && (
          <>
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <span className="text-green-600 text-3xl">[OK]</span>
            </div>
            <p className="text-sm text-muted-foreground">{message}</p>
            <Button asChild className="w-full"><Link href="/login">Go to Login</Link></Button>
          </>
        )}
        {status === "error" && (
          <>
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
              <span className="text-red-600 text-3xl">[X]</span>
            </div>
            <p className="text-sm text-destructive">{message}</p>
            <Button asChild variant="outline" className="w-full"><Link href="/login">Back to Login</Link></Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <Card>
        <CardContent className="flex justify-center py-16">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </CardContent>
      </Card>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
}