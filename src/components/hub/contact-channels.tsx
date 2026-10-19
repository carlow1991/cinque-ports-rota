import { Checkbox } from "@/components/ui";
import { CONTACT_CHANNELS } from "@/lib/domain/hub-tags";

/** "How can we contact you?" — tick as many as apply. */
export function ContactChannelsField({ selected, legend = "Ways to contact you" }: { selected: readonly string[] | null | undefined; legend?: string }) {
  const on = new Set(selected ?? []);
  return (
    <fieldset>
      <legend className="text-sm font-semibold">{legend}</legend>
      <p className="text-xs text-ink-muted">Tick all that apply.</p>
      <div className="grid gap-x-4 sm:grid-cols-2">
        {CONTACT_CHANNELS.map((c) => <Checkbox key={c.code} name="contact_channels" value={c.code} label={c.label} defaultChecked={on.has(c.code)} />)}
      </div>
    </fieldset>
  );
}
