"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface ComboboxOption {
  value: string;
  label: string;
  group?: string;
  sublabel?: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Select an option...",
  searchPlaceholder = "Search...",
  className,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = React.useState<React.CSSProperties>({});

  const selected = options.find((o) => o.value === value);

  // Position dropdown relative to trigger using fixed positioning
  const updatePosition = React.useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropdownHeight = 320;

    if (spaceBelow >= dropdownHeight || spaceBelow >= 200) {
      // Open below
      setDropdownStyle({
        position: "fixed",
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        zIndex: 9999,
      });
    } else {
      // Open above
      setDropdownStyle({
        position: "fixed",
        bottom: window.innerHeight - rect.top + 4,
        left: rect.left,
        width: rect.width,
        zIndex: 9999,
      });
    }
  }, []);

  const handleOpen = () => {
    updatePosition();
    setOpen(true);
  };

  // Filter options
  const filtered = React.useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.group?.toLowerCase().includes(q) ||
        o.sublabel?.toLowerCase().includes(q),
    );
  }, [options, search]);

  // Group results
  const groups = React.useMemo(() => {
    const map = new Map<string, ComboboxOption[]>();
    for (const opt of filtered) {
      const g = opt.group ?? "";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(opt);
    }
    return map;
  }, [filtered]);

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
      setSearch("");
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  // Close on scroll/resize
  React.useEffect(() => {
    if (!open) return;
    const handle = () => { setOpen(false); setSearch(""); };
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, [open]);

  return (
    <div className={cn("relative w-full", className)}>
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        {selected ? (
          <span className="truncate text-left">{selected.label}</span>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </button>

      {/* Dropdown  --  rendered via portal-like fixed positioning */}
      {open && (
        <div
          ref={dropdownRef}
          style={{ ...dropdownStyle, backgroundColor: "white" }}
          className="rounded-md border text-foreground shadow-2xl ring-1 ring-black/5"
        >
          {/* Search */}
          <div className="flex items-center gap-2 border-b px-3 py-2 rounded-t-md" style={{ backgroundColor: "white" }}>
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* List */}
          <div className="max-h-72 overflow-y-auto p-1 rounded-b-md" style={{ backgroundColor: "white" }}>
            {groups.size === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No services found.
              </p>
            ) : (
              Array.from(groups.entries()).map(([group, items]) => (
                <div key={group}>
                  {group && (
                    <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {group}
                    </p>
                  )}
                  {items.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => {
                        onValueChange(item.value);
                        setOpen(false);
                        setSearch("");
                      }}
                      className="relative flex w-full cursor-pointer select-none items-start gap-2 rounded-sm px-2 py-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                    >
                      <Check
                        className={cn(
                          "mt-0.5 h-4 w-4 shrink-0",
                          value === item.value ? "opacity-100 text-primary" : "opacity-0",
                        )}
                      />
                      <div className="flex-1 text-left">
                        <p className="font-medium leading-snug">{item.label}</p>
                        {item.sublabel && (
                          <p className="text-xs text-muted-foreground mt-0.5">{item.sublabel}</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
