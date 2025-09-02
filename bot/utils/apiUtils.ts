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
    telegramId: number; // <-- добавляем
    vacancyId: string;
    resumeId: string;
    coverLetter?: string;
}

export async function applyToVacancy({telegramId, vacancyId, coverLetter}: {
    telegramId: number,
    vacancyId: string,
    coverLetter?: string
}) {
    try {
        // Получаем токен пользователя
        const {data: user} = await axios.get(`${getBackendUrl()}/user/${telegramId}`);
        if (!user.hhAccessToken) throw new Error("Нет токена HH");

        // Получаем список резюме с HH
        const resumesRes = await axios.get('https://api.hh.ru/resumes', {
            headers: {Authorization: `Bearer ${user.hhAccessToken}`}
        });

        if (!resumesRes.data.items || resumesRes.data.items.length === 0) {
            throw new Error("У пользователя нет резюме на HH");
        }

        const resumeId = resumesRes.data.items[0].id; // <-- первый доступный резюме

        const payload: any = {resume: resumeId};
        if (coverLetter) payload.cover_letter = coverLetter;

        // Отправка отклика
        const res = await axios.post(`https://api.hh.ru/vacancies/${vacancyId}/responses`, payload, {
            headers: {
                Authorization: `Bearer ${user.hhAccessToken}`,
                "User-Agent": "HH-Bot/1.0 (vladislavtatyankin01@gmail.com)",
                "Content-Type": "application/json"
            }
        });

        return res.data;

    } catch (err: any) {
        console.error("Ошибка отклика на вакансию:", err.response?.data || err.message);
        throw new Error(`Не удалось откликнуться на вакансию ${vacancyId}`);
    }
}


