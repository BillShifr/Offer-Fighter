import axios from "axios";
import {HHRegion} from "../types";

// функция для безопасного получения BACKEND_URL
function getBackendUrl(): string {
    const url = process.env.BACKEND_URL;
    if (!url) throw new Error("BACKEND_URL не задан в .env");
    return url;
}

// Получение резюме пользователя
export async function getUserResumes(telegramId: number) {
    try {
        const BACKEND_URL = process.env.BACKEND_URL;
        if (!BACKEND_URL) {
            throw new Error("BACKEND_URL не задан в .env");
        }

        console.log("Запрос резюме для Telegram ID:", telegramId);
        const res = await axios.get(`${BACKEND_URL}/user/${telegramId}/resumes`);

        // Добавляем отладочную информацию
        console.log("Данные резюме от API:", JSON.stringify(res.data, null, 2));

        // HH API возвращает объект с полем items или массив напрямую
        const resumes = res.data.items || res.data || [];
        console.log("Обработанные резюме:", resumes);

        return resumes;
    } catch (err) {
        console.error("Ошибка получения резюме:", err);
        throw new Error("Не удалось получить резюме");
    }
}

// Поиск вакансий
export async function searchVacancies(payload: any): Promise<any[]> {
    try {
        const res = await axios.post(`${getBackendUrl()}/search`, payload);
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
