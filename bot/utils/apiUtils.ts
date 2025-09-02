import axios from "axios";
import { HHRegion } from "../types";

// функция для безопасного получения BACKEND_URL
function getBackendUrl(): string {
    const url = process.env.BACKEND_URL;
    if (!url) throw new Error("BACKEND_URL не задан в .env");
    return url;
}

// Получение резюме пользователя
export async function getUserResumes(telegramId: number) {
    try {
        const res = await axios.get(`${getBackendUrl()}/api/user/${telegramId}/resumes`);
        return res.data.items || res.data || [];
    } catch (err) {
        console.error("Ошибка получения резюме:", err);
        return [];
    }
}

// Поиск вакансий
export async function searchVacancies(payload: any): Promise<any[]> {
    try {
        const res = await axios.get("https://api.hh.ru/vacancies", {
            params: payload,
        });
        return res.data.items || [];
    } catch (e) {
        console.error("Ошибка поиска:", e);
        return [];
    }
}

export async function getHHRegions(): Promise<any> {
    try {
        const response = await axios.get<HHRegion[]>("https://api.hh.ru/areas");
        return response.data;
    } catch (error) {
        console.error("Error fetching regions:", error);
        throw new Error("Failed to fetch regions");
    }
}

interface ApplyPayload {
    telegramId: number;
    vacancyId: string;
    resumeId: string;
    coverLetter?: string;
}

export async function applyToVacancy({ telegramId, vacancyId, resumeId, coverLetter }: ApplyPayload) {
    try {
        const res = await axios.post(`${getBackendUrl()}/api/vacancies/apply`, {
            telegramId,
            vacancyId,
            resumeId,
            coverLetter
        });
        return res.data;
    } catch (err: any) {
        console.error(`Ошибка отклика на вакансию ${vacancyId}:`, err.response?.data || err.message);
        throw new Error(`Не удалось откликнуться на вакансию ${vacancyId}`);
    }
}