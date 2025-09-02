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
        const res = await axios.get(`${getBackendUrl()}/user/${telegramId}/resumes`);
        return res.data.items || res.data || [];
    } catch (err) {
        console.error("Ошибка получения резюме:", err);
        return [];
    }
}

// Поиск вакансий
export async function searchVacancies(payload: any): Promise<any[]> {
    try {
        const res = await axios.get(`${getBackendUrl()}/search`, payload);
        return res.data || [];
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
