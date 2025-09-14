"use client";
import React from 'react';
import { Toaster } from 'sonner';

export function ToastProvider() {
  return (
    <Toaster richColors position="top-right" expand={false} />
  );
}
