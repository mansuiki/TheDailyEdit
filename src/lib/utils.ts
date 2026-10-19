// Source: https://www.obsidianui.dev/r/tabs.json
// Copyright (c) 2026 ObsidianUI. MIT; see THIRD_PARTY_NOTICES.md.
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
