import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">
      <h1 className="text-2xl font-bold text-club">Not found</h1>
      <p className="mt-2">That page or event could not be found. It may have been removed, or it isn&apos;t open to volunteers yet.</p>
      <Link href="/rota" className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-club px-4 font-semibold text-white">Back to the rota</Link>
    </main>
  );
}
