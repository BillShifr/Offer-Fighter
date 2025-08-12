import axios from "axios";
import {HHRegion} from "../types";

const BACKEND_URL = process.env.BACKEND_URL!;

// Получение резюме пользователя
export async function getUserResumes(telegramId: number) {
    try {
        const res = await axios.get(`${BACKEND_URL}/user/${telegramId}/resumes`);
        return res.data.items || res.data || [];
    } catch (err) {
        console.error("Ошибка получения резюме:", err);
        return [];
    }
}

// Поиск вакансий
export async function searchVacancies(payload: any): Promise<any[]> {
    try {
        const res = await axios.post(`${BACKEND_URL}/search`, payload);
        return res.data || [];
    } catch (e) {
        console.error("Ошибка поиска:", e);
        return [];
    }
}


export async function getHHRegions(): Promise<any> {
    try {
        const response = await axios.get<any[]>("https://api.hh.ru/areas");
        return response.data;
    } catch (error) {
        console.error("Error fetching regions:", error);
        throw new Error("Failed to fetch regions");
    }
}