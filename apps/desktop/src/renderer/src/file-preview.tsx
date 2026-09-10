import React from "react";
import { Diff, Hunk, parseDiff } from "react-diff-view";
import { useTranslation } from "react-i18next";
import "react-diff-view/style/index.css";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import type { ChangeEntry, FilePreview } from "../../shared/file-protocol.js";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export function ContentPreview({
  preview,
}: {
  preview: FilePreview;
}): React.JSX.Element {
  const { t } = useTranslation();
  const value = preview.document;
  if (value.kind === "text")
    return <pre className="file-content">{value.text}</pre>;
  if (value.kind === "image")
    return (
      <div className="media-preview">
        {preview.dataUrl && <img src={preview.dataUrl} alt={value.source} />}
        <p>
          {value.width ?? "?"} × {value.height ?? "?"} ·{" "}
          {t("live.bytes", { count: value.bytes })}
        </p>
        <small>{t("live.imageScope")}</small>
      </div>
    );
  if (value.kind === "table")
    return (
      <div className="table-preview">
        <p>
          {t("live.rowRange", {
            start: value.rowStart,
            end: value.rowEnd,
            total: value.totalRows,
          })}
        </p>
        <table>
          <tbody>
            {value.rows.map((row, rowIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: The immutable preview range has no row identity beyond its source row number.
              <tr key={`${value.rowStart + rowIndex}`}>
                <th>{value.rowStart + rowIndex}</th>
                {row.map((cell, column) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: Columns in the immutable parsed row are positional.
                  <td key={`${column}-${cell}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {value.calculation && (
          <p>
            {t("live.calculation", {
              operation: value.calculation.operation,
              column: value.calculation.column,
              value: value.calculation.value ?? t("live.noNumericValues"),
              count: value.calculation.rowsConsidered,
            })}
          </p>
        )}
        {value.errors.map((error) => (
          <p className="field-error" key={`${error.row}-${error.code}`}>
            {t("live.rowError", { row: error.row, message: error.message })}
          </p>
        ))}
      </div>
    );
  return (
    <div className="pdf-preview">
      {preview.dataUrl && (
        <PdfCanvas dataUrl={preview.dataUrl} page={value.pageStart} />
      )}
      <p>
        {t("live.pageRange", {
          start: value.pageStart,
          end: value.pageEnd,
          total: value.totalPages,
        })}
      </p>
      {value.pages.map((page) => (
        <section key={page.page}>
          <h4>{t("live.page", { page: page.page })}</h4>
          <p>{page.textless ? t("live.noPdfText") : page.text}</p>
        </section>
      ))}
      {value.note && <small>{t("live.noPdfText")}</small>}
    </div>
  );
}

function PdfCanvas({
  dataUrl,
  page,
}: {
  dataUrl: string;
  page: number;
}): React.JSX.Element {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    let disposed = false;
    let cancelRender: (() => void) | undefined;
    const bytes = Uint8Array.from(
      atob(dataUrl.split(",")[1] ?? ""),
      (character) => character.charCodeAt(0),
    );
    const loading = pdfjs.getDocument({
      data: bytes,
      useSystemFonts: true,
      useWorkerFetch: false,
    });
    void loading.promise
      .then(async (document) => {
        const selected = await document.getPage(page);
        if (disposed || !canvas.current) return;
        const viewport = selected.getViewport({ scale: 1.25 });
        canvas.current.width = viewport.width;
        canvas.current.height = viewport.height;
        const context = canvas.current.getContext("2d");
        if (!context) return;
        const task = selected.render({
          canvas: canvas.current,
          canvasContext: context,
          viewport,
        });
        cancelRender = () => task.cancel();
        await task.promise;
      })
      .catch((cause: unknown) => {
        if (!disposed)
          setError(
            cause instanceof Error ? cause.message : "PDF preview failed",
          );
      });
    return () => {
      disposed = true;
      cancelRender?.();
      void loading.destroy();
    };
  }, [dataUrl, page]);
  return (
    <>
      {error ? <p className="field-error">{error}</p> : <canvas ref={canvas} />}
    </>
  );
}

export function DiffViewer({
  entry,
}: {
  entry: ChangeEntry;
}): React.JSX.Element {
  const { t } = useTranslation();
  if (!entry.patch) return <p>{t("live.diffUnavailable")}</p>;
  try {
    const file = parseDiff(entry.patch)[0];
    if (!file) return <pre>{entry.patch}</pre>;
    return (
      <Diff viewType="unified" diffType={file.type} hunks={file.hunks}>
        {(hunks) =>
          hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)
        }
      </Diff>
    );
  } catch {
    return <pre>{entry.patch}</pre>;
  }
}
