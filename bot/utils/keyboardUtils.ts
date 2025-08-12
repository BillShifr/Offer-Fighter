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
            item.name || item.title || `ID: ${item.id}`,
            `${cbPrefix}${item.id}`
        )
    );

    // Добавляем дополнительные кнопки в начало
    additionalButtons.forEach(btn => {
        buttons.unshift(Markup.button.callback(btn.text, `${cbPrefix}${btn.data}`));
    });

    // Группируем кнопки по колонкам
    const rows = [];
    for (let i = 0; i < buttons.length; i += columns) {
        rows.push(buttons.slice(i, i + columns));
    }

    // Возвращаем полноценную клавиатуру
    return Markup.inlineKeyboard(rows);
}

// Type-guard для callbackQuery с data
export function hasCallbackData(q: any): q is { data: string } {
    return q && typeof q === "object" && "data" in q && typeof q.data === "string";
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