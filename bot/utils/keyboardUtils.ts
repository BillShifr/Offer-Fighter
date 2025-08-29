// Утилита для построения inline клавиатуры
import {Markup} from "telegraf";

import axios from "axios";
import {HHRegion} from "../types";

export function buildKeyboardButtons(
    items: any[],
    cbPrefix: string,
    columns = 2,
    additionalButtons: { text: string; data: string }[] = []
) {
    // Создаем основные кнопки
    const buttons = items.map(item =>
        Markup.button.callback(
            item.name || `График: ${item.id}`,
            `${cbPrefix}${item.id}`
        )
    );

    // Добавляем дополнительные кнопки
    additionalButtons.forEach(btn => {
        buttons.push(Markup.button.callback(btn.text, `${cbPrefix}${btn.data}`));
    });

    // Группируем кнопки по колонкам
    const rows = [];
    for (let i = 0; i < buttons.length; i += columns) {
        rows.push(buttons.slice(i, i + columns));
    }

    return Markup.inlineKeyboard(rows);
}

// Получение регионов с API HH
export async function getHHRegions(): Promise<HHRegion[]> {
    try {
        const response = await axios.get("https://api.hh.ru/areas");
        return response.data;
    } catch (error) {
        console.error("Ошибка получения регионов:", error);
        return [];
    }
}

export function hasCallbackData(q: any): q is { data: string } {
    return q && typeof q === "object" && "data" in q && typeof q.data === "string";
}