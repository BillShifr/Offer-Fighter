// Форматирование зарплаты
export function formatSalary(salary?: {
    from?: number;
    to?: number;
    currency?: string;
    gross?: boolean;
}): string {
    if (!salary) return "Не указана";

    const from = salary.from ? Math.round(salary.from).toLocaleString() : "?";
    const to = salary.to ? Math.round(salary.to).toLocaleString() : "?";
    const currency = salary.currency || "";
    const gross = salary.gross ? " (до вычета налогов)" : " (на руки)";

    return `${from}-${to} ${currency}${gross}`;
}