export const databaseDrivers = ["postgres", "neon"] as const;

export type DatabaseDriver = (typeof databaseDrivers)[number];

type DatabaseEnvironment = {
  DATABASE_DRIVER?: string;
  DATABASE_URL?: string;
  NODE_ENV?: string;
};

export type DatabaseConfig = {
  driver: DatabaseDriver;
  connectionString: string;
};

export function resolveDatabaseConfig(environment: DatabaseEnvironment): DatabaseConfig | null {
  const connectionString = environment.DATABASE_URL?.trim();
  const configuredDriver = environment.DATABASE_DRIVER?.trim();

  if (!connectionString && environment.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is required in production");
  }

  if (configuredDriver && !databaseDrivers.includes(configuredDriver as DatabaseDriver)) {
    throw new Error('DATABASE_DRIVER must be either "postgres" or "neon"');
  }

  if (!connectionString) {
    if (configuredDriver) throw new Error("DATABASE_URL is required when DATABASE_DRIVER is configured");
    return null;
  }

  if (!configuredDriver) {
    throw new Error('DATABASE_DRIVER is required when DATABASE_URL is configured; use "postgres" or "neon"');
  }

  return {
    driver: configuredDriver as DatabaseDriver,
    connectionString,
  };
}
