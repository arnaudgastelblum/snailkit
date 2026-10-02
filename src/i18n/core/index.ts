import type { Translations } from "../index";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { nl } from "./nl";

export const CORE_STRINGS: Translations<typeof en> = { en, fr, nl, es };
