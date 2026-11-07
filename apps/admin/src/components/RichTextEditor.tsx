import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import {
  FormatBold,
  FormatColorText,
  FormatItalic,
  FormatListBulleted,
  FormatListNumbered,
  FormatUnderlined,
  Redo,
  Undo,
} from "@mui/icons-material";
import {
  Box,
  IconButton,
  Paper,
  Popover,
  Stack,
  Tooltip,
} from "@mui/material";

/** Text colors offered in the editor; keep these compatible with the server allowlist. */
const TEXT_COLORS = [
  { name: "Schwarz", value: "#000000" },
  { name: "Grau", value: "#6b6b6b" },
  { name: "Rot", value: "#c62828" },
  { name: "Orange", value: "#ea5b27" },
  { name: "Grün", value: "#2e7d32" },
  { name: "Blau", value: "#28527a" },
] as const;

export function RichTextEditor({
  initialHtml,
  disabled,
  onChange,
  ariaLabel = "E-Mail-Text",
}: {
  initialHtml: string;
  disabled: boolean;
  onChange: (html: string) => void;
  ariaLabel?: string;
}) {
  const onChangeRef = useRef(onChange);
  const [colorAnchor, setColorAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    extensions: [
      // Match the server sanitizer's allowlist.
      StarterKit.configure({
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        heading: { levels: [2, 3] },
        link: { openOnClick: false },
      }),
      TextStyle,
      Color,
      Table,
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: initialHtml,
    editable: !disabled,
    onUpdate: ({ editor: current }) =>
      onChangeRef.current(current.getHTML()),
  });

  useEffect(() => {
    if (editor) onChangeRef.current(editor.getHTML());
  }, [editor]);
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive("bold") ?? false,
      italic: current?.isActive("italic") ?? false,
      underline: current?.isActive("underline") ?? false,
      bulletList: current?.isActive("bulletList") ?? false,
      orderedList: current?.isActive("orderedList") ?? false,
      color: (current?.getAttributes("textStyle").color as string | undefined)
        ?.toLowerCase(),
    }),
  });
  if (!editor) return null;

  const applyColor = (value: string | null) => {
    const chain = editor.chain().focus();
    if (value) chain.setColor(value).run();
    else chain.unsetColor().run();
    setColorAnchor(null);
  };
  const tools: Array<{
    label: string;
    icon: ReactNode;
    active: boolean;
    run: (event: MouseEvent<HTMLElement>) => void;
  }> = [
    {
      label: "Fett",
      icon: <FormatBold fontSize="small" />,
      active: active?.bold ?? false,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "Kursiv",
      icon: <FormatItalic fontSize="small" />,
      active: active?.italic ?? false,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "Unterstrichen",
      icon: <FormatUnderlined fontSize="small" />,
      active: active?.underline ?? false,
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      label: "Textfarbe",
      icon: (
        <FormatColorText
          fontSize="small"
          sx={active?.color ? { color: active.color } : undefined}
        />
      ),
      active: Boolean(active?.color),
      run: (event) => setColorAnchor(event.currentTarget),
    },
    {
      label: "Aufzählung",
      icon: <FormatListBulleted fontSize="small" />,
      active: active?.bulletList ?? false,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Nummerierung",
      icon: <FormatListNumbered fontSize="small" />,
      active: active?.orderedList ?? false,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Rückgängig",
      icon: <Undo fontSize="small" />,
      active: false,
      run: () => editor.chain().focus().undo().run(),
    },
    {
      label: "Wiederholen",
      icon: <Redo fontSize="small" />,
      active: false,
      run: () => editor.chain().focus().redo().run(),
    },
  ];

  return (
    <Paper variant="outlined">
      <Stack
        direction="row"
        spacing={0.5}
        sx={{ px: 1, py: 0.5, borderBottom: 1, borderColor: "divider" }}
      >
        {tools.map((tool) => (
          <Tooltip key={tool.label} title={tool.label}>
            <span>
              <IconButton
                size="small"
                aria-label={tool.label}
                aria-pressed={tool.active}
                color={tool.active ? "primary" : "default"}
                disabled={disabled}
                onClick={tool.run}
              >
                {tool.icon}
              </IconButton>
            </span>
          </Tooltip>
        ))}
      </Stack>
      <Popover
        open={Boolean(colorAnchor)}
        anchorEl={colorAnchor}
        onClose={() => setColorAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Stack
          direction="row"
          spacing={0.5}
          role="group"
          aria-label="Textfarbe wählen"
          sx={{ p: 1 }}
        >
          {TEXT_COLORS.map((color) => (
            <Tooltip key={color.value} title={color.name}>
              <IconButton
                size="small"
                aria-label={color.name}
                aria-pressed={active?.color === color.value}
                onClick={() => applyColor(color.value)}
                sx={{
                  border: 1,
                  borderColor:
                    active?.color === color.value ? "primary.main" : "divider",
                }}
              >
                <Box
                  sx={{
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    bgcolor: color.value,
                  }}
                />
              </IconButton>
            </Tooltip>
          ))}
          <Tooltip title="Standardfarbe">
            <IconButton
              size="small"
              aria-label="Standardfarbe"
              onClick={() => applyColor(null)}
            >
              <FormatColorText fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Popover>
      <Box
        sx={{
          px: 2,
          minHeight: 240,
          maxHeight: "55vh",
          overflowY: "auto",
          "& .tiptap": { outline: "none", minHeight: 240 },
          "& table": { borderCollapse: "collapse", my: 1 },
          "& td, & th": {
            border: 1,
            borderColor: "divider",
            px: 1,
            py: 0.5,
            verticalAlign: "top",
          },
          "& td p, & th p": { m: 0 },
        }}
      >
        <EditorContent editor={editor} aria-label={ariaLabel} />
      </Box>
    </Paper>
  );
}
