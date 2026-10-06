import { createElement } from "react"
import type { EntryType } from "@/lib/ledger-storage"
import { categoryIconFor } from "@/lib/category-icons"

export function CategoryGlyph({ category, type }: { category: string; type: EntryType }) {
  const Icon = categoryIconFor(category, type)
  return createElement(Icon, { "aria-hidden": true })
}
