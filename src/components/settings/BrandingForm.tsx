"use client";

import { ImageIcon, Trash2Icon, UploadIcon } from "lucide-react";
import Image from "next/image";
import { useId, useRef, useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { removeStoreLogo, saveStoreBranding, type BrandingFormValues } from "@/actions/store-settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { brandColorSchema } from "@/schemas/stores";

import { BrandPreview } from "./BrandPreview";
import { describedBy, FormField } from "./FormField";

interface BrandingFormProps {
  storeName: string;
  initialColors: BrandingFormValues;
  initialLogoUrl: string | null;
}

// Mirrors the server's limits so obvious mistakes are caught before
// uploading. The server checks everything again from the file's bytes.
const LOGO_MAX_BYTES = 1024 * 1024;
const LOGO_ACCEPT = "image/png,image/jpeg,image/webp";
const LOGO_UPLOAD_PATH = "/api/v1/store/logo";

const uploadResponseSchema = z.union([
  z.object({ ok: z.literal(true), logoUrl: z.string().nullable() }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);

const COLOR_HINTS = {
  primaryColor: "Buttons and links on your customer pages.",
  accentColor: "Highlights such as badges.",
};

export function BrandingForm({ storeName, initialColors, initialLogoUrl }: BrandingFormProps) {
  const [saved, setSaved] = useState(initialColors);
  const [colors, setColors] = useState(initialColors);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [savingColors, startSavingColors] = useTransition();
  const [logoBusy, setLogoBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const dirty = colors.primaryColor !== saved.primaryColor || colors.accentColor !== saved.accentColor;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startSavingColors(async () => {
      const result = await saveStoreBranding(formData);
      if (result.ok) {
        setSaved(result.values);
        setColors(result.values);
        setErrors({});
        toast.success(result.message);
      } else {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.message);
      }
    });
  }

  function cancel() {
    setColors(saved);
    setErrors({});
  }

  async function uploadLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > LOGO_MAX_BYTES) {
      toast.error("Your logo must be 1 MB or smaller.");
      return;
    }

    setLogoBusy(true);
    try {
      // The raw file as the body; the server decides its type from the bytes.
      const response = await fetch(LOGO_UPLOAD_PATH, { method: "POST", body: file });
      const parsed = uploadResponseSchema.safeParse(await response.json().catch(() => null));
      if (parsed.success && parsed.data.ok) {
        setLogoUrl(parsed.data.logoUrl);
        toast.success(logoUrl ? "Logo replaced" : "Logo uploaded");
      } else {
        toast.error(parsed.success && !parsed.data.ok ? parsed.data.message : "We couldn't save your logo. Please try again.");
      }
    } catch {
      toast.error("We couldn't upload your logo. Check your connection and try again.");
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    setLogoBusy(true);
    try {
      const result = await removeStoreLogo();
      if (result.ok) {
        setLogoUrl(null);
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error("We couldn't remove your logo. Please try again.");
    } finally {
      setLogoBusy(false);
    }
  }

  return (
    <Card id="branding" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>Branding</CardTitle>
        <CardDescription>
          Your logo and colours appear only on your customer pages. Your workspace keeps Fluta&apos;s look.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-section">
        <section aria-labelledby="logo-heading" className="flex flex-col gap-component">
          <h3 id="logo-heading" className="type-label text-foreground">
            Logo
          </h3>
          <div className="flex flex-col gap-form xs:flex-row xs:items-center">
            <div className="relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
              {logoUrl ? (
                <Image src={logoUrl} alt={`${storeName} logo`} fill sizes="80px" unoptimized className="object-contain" />
              ) : (
                <ImageIcon className="size-6 text-muted-foreground" role="img" aria-label="No logo yet" />
              )}
            </div>
            <div className="flex flex-col gap-component">
              <p id="logo-hint" className="type-caption text-muted-foreground">
                PNG, JPEG or WebP, up to 1 MB and 2000 × 2000 pixels. SVG isn&apos;t supported.
              </p>
              <div className="flex flex-wrap gap-component">
                <input
                  ref={fileInput}
                  type="file"
                  accept={LOGO_ACCEPT}
                  onChange={uploadLogo}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInput.current?.click()}
                  disabled={logoBusy}
                  aria-describedby="logo-hint"
                >
                  <UploadIcon data-icon="inline-start" aria-hidden />
                  {logoBusy ? "Saving…" : logoUrl ? "Replace logo" : "Upload logo"}
                </Button>
                {logoUrl && (
                  <Button type="button" variant="ghost" onClick={removeLogo} disabled={logoBusy}>
                    <Trash2Icon data-icon="inline-start" aria-hidden />
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </div>
        </section>

        <form onSubmit={submit} className="flex flex-col gap-form" noValidate aria-labelledby="colours-heading">
          <div className="flex flex-col gap-1">
            <h3 id="colours-heading" className="type-label text-foreground">
              Colours
            </h3>
            <p className="type-caption text-muted-foreground">
              Use #RRGGBB, or leave blank for Fluta&apos;s colours. Text colours are chosen for you, and shades
              are adjusted where needed, so pages stay readable in light and dark.
            </p>
          </div>
          <div className="grid gap-form md:grid-cols-2">
            <ColorField
              name="primaryColor"
              label="Primary colour"
              hint={COLOR_HINTS.primaryColor}
              value={colors.primaryColor}
              error={errors.primaryColor}
              onChange={(value) => setColors((current) => ({ ...current, primaryColor: value }))}
            />
            <ColorField
              name="accentColor"
              label="Accent colour"
              hint={COLOR_HINTS.accentColor}
              value={colors.accentColor}
              error={errors.accentColor}
              onChange={(value) => setColors((current) => ({ ...current, accentColor: value }))}
            />
          </div>

          <div className="flex flex-col gap-2">
            <p className="type-label text-foreground">Preview</p>
            <BrandPreview
              storeName={storeName}
              logoUrl={logoUrl}
              colors={{ primary: colors.primaryColor, accent: colors.accentColor }}
            />
          </div>

          <div className="flex flex-col-reverse gap-component xs:flex-row xs:justify-end">
            <Button type="button" variant="ghost" onClick={cancel} disabled={!dirty || savingColors}>
              Cancel
            </Button>
            <Button type="submit" disabled={!dirty || savingColors}>
              {savingColors ? "Saving…" : "Save colours"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

interface ColorFieldProps {
  name: keyof BrandingFormValues;
  label: string;
  hint: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}

// A colour picker plus the hex value as text; the text field is what's sent.
function ColorField({ name, label, hint, value, error, onChange }: ColorFieldProps) {
  const id = useId();
  const valid = brandColorSchema.safeParse(value).success;
  return (
    <FormField id={id} label={label} hint={hint} error={error}>
      <div className="flex gap-component">
        <input
          type="color"
          value={valid ? value.toLowerCase() : "#ffffff"}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          aria-label={`${label} picker`}
          className="h-11 w-14 shrink-0 cursor-pointer rounded-lg border border-input bg-card p-1"
        />
        <Input
          id={id}
          name={name}
          value={value}
          onChange={(event) => onChange(event.target.value.trim())}
          placeholder="Not set"
          maxLength={7}
          spellCheck={false}
          autoCapitalize="characters"
          className="font-mono uppercase placeholder:font-sans placeholder:normal-case"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
        />
      </div>
    </FormField>
  );
}
