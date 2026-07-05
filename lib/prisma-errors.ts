export function isPrismaConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = `${error.name}: ${error.message}`;
  return (
    error.name === "PrismaClientInitializationError" ||
    message.includes("Can't reach database server") ||
    message.includes("Error querying the database")
  );
}