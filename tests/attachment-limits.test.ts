import { describe, expect, it } from "vitest";
import { isImageUploadWithinLimit, MAX_IMAGE_UPLOAD_BYTES } from "@/lib/assistant/attachment-limits";

describe("Vercel-safe image upload limits", () => {
  it("allows an upload up to the aggregate 4 MB limit", () => {
    expect(isImageUploadWithinLimit([{ size: 1_500_000 }, { size: 2_500_000 }])).toBe(true);
  });

  it("rejects files or totals that can exceed the function body limit", () => {
    expect(isImageUploadWithinLimit([{ size: MAX_IMAGE_UPLOAD_BYTES + 1 }])).toBe(false);
    expect(isImageUploadWithinLimit([{ size: 1_400_000 }, { size: 1_400_000 }, { size: 1_400_000 }])).toBe(false);
  });

  it("rejects empty files and more than three images", () => {
    expect(isImageUploadWithinLimit([{ size: 0 }])).toBe(false);
    expect(isImageUploadWithinLimit([{ size: 1 }, { size: 1 }, { size: 1 }, { size: 1 }])).toBe(false);
  });
});
