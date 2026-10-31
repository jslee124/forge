import { useState } from "react";
export function Composer({ send }: { send: (text: string) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        send(draft);
      }}
    >
      <input value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button type="submit">Send</button>
    </form>
  );
}
