export const number = (value, digits = 0) =>
  Number.isFinite(value)
    ? new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits }).format(
        value,
      )
    : "—";
