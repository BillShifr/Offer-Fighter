import axios from "axios";

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