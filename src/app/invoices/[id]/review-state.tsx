"use client";

import { createContext, useContext, useState } from "react";

/** Lets the export panel know the editor has unsaved changes (export uses the saved version). */
const ReviewState = createContext<{ dirty: boolean; setDirty: (dirty: boolean) => void }>({
  dirty: false,
  setDirty: () => {},
});

export function ReviewStateProvider({ children }: { children: React.ReactNode }) {
  const [dirty, setDirty] = useState(false);
  return <ReviewState value={{ dirty, setDirty }}>{children}</ReviewState>;
}

export const useReviewState = () => useContext(ReviewState);
