import { Box, Tab, Tabs } from "@mui/material";

export interface SectionTab {
  label: string;
  value: string | number;
  id?: string;
  ariaControls?: string;
}

interface SectionTabsProps {
  label: string;
  value: string | number;
  tabs: SectionTab[];
  onChange: (value: string | number) => void;
  sticky?: boolean;
}

export function SectionTabs({
  label,
  value,
  tabs,
  onChange,
  sticky = false,
}: SectionTabsProps) {
  return (
    <Box
      sx={
        sticky
          ? {
              position: "sticky",
              top: { xs: 58, md: 68 },
              zIndex: 2,
              pb: 1,
              backgroundColor: "var(--mui-palette-background-default)",
              borderBottom: "1px solid var(--mui-palette-divider)",
            }
          : { pb: 1 }
      }
    >
      <Tabs
        value={value}
        onChange={(_, next: string | number) => onChange(next)}
        variant="scrollable"
        allowScrollButtonsMobile
        aria-label={label}
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.value}
            label={tab.label}
            value={tab.value}
            {...(tab.id ? { id: tab.id } : {})}
            {...(tab.ariaControls ? { "aria-controls": tab.ariaControls } : {})}
          />
        ))}
      </Tabs>
    </Box>
  );
}
