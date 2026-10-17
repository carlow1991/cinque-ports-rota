"use client";

import { ErrorPanel } from "@/components/error-panel";

export default function ManageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorPanel error={error} retry={retry} home="/manage" homeLabel="Back to the dashboard" />;
}
