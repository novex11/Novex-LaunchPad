"use client";

import * as Accordion from "@radix-ui/react-accordion";
import { CaretDown } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export function LandingAccordion({
  items,
}: {
  items: Array<{ q: string; a: string }>;
}) {
  return (
    <Accordion.Root type="single" collapsible className="border-t border-border">
      {items.map((item, i) => (
        <Accordion.Item key={item.q} value={`item-${i}`} className="border-b border-border">
          <Accordion.Header>
            <Accordion.Trigger className="group flex w-full items-center justify-between px-4 py-5 text-left text-sm font-medium transition-colors hover:bg-surface-muted md:px-8">
              {item.q}
              <CaretDown
                size={16}
                className="shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
              />
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Content className="overflow-hidden data-[state=closed]:animate-[fade-out_200ms_ease-out] data-[state=open]:animate-[fade-in_200ms_ease-out]">
            <p className="px-4 pb-5 text-sm leading-relaxed text-muted-foreground md:px-8">
              {item.a}
            </p>
          </Accordion.Content>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  );
}
