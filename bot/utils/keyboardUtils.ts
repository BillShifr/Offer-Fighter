import {Markup} from "telegraf";
import {HHRegion} from "../../types";
import axios from "axios";

// Утилита для построения inline клавиатуры
export function buildKeyboardButtons(
    items: any[],
    cbPrefix: string,
    columns = 2,
    additionalButtons: { text: string; data: string }[] = []
) {
    const buttons = items.map((item) =>
        Markup.button.callback(item.name || item.title || item.id, `${cbPrefix}${item.id}`)
    );

    additionalButtons.forEach(btn => {
        buttons.unshift(Markup.button.callback(btn.text, `${cbPrefix}${btn.data}`));
    });

    const rows = [];
    for (let i = 0; i < buttons.length; i += columns) {
        rows.push(buttons.slice(i, i + columns));
    }

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