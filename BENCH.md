# Benchmark

What `npm run bench` measured on `@sveltekit-i18n/typegen` 3.1.0, written by the release that published it. A pull request compares its branch with its base in a comment; this file keeps the figures of each release beside its code.

Node v24.21.0, linux x64; times and heap readings are medians of 11 processes, a time each the median of its rounds, or of one call where an app generates once; a spread leaves out the lowest and the highest quarter of them, rounded down.

## Counts

Calls, config loads, and the checker's types and instantiations: the same on every machine. A pull request that grows one fails its benchmark job unless it carries the `bench-accepted` label.

| Row | Value |
| --- | ---: |
| loader calls, a generation (10,000 keys in namespaces, 2 locales) | 1,000  |
| extractor calls, a generation (10,000 keys in namespaces) | 10,000  |
| addTranslations calls, a generation (10,000 keys in namespaces, 2 locales) | 2  |
| checker types, the artifact of 10,000 flat keys and five t calls | 48,378  |
| checker instantiations, the artifact of 10,000 flat keys and five t calls | 1,522  |
| checker types, the artifact of 10,000 keys in namespaces and five t calls | 49,378  |
| checker instantiations, the artifact of 10,000 keys in namespaces and five t calls | 1,522  |
| checker types, the artifact of 10,000 keys in one namespace and five t calls | 48,380  |
| checker instantiations, the artifact of 10,000 keys in one namespace and five t calls | 1,522  |
| checker types, the artifact of 10,000 nested keys and five t calls | 50,600  |
| checker instantiations, the artifact of 10,000 nested keys and five t calls | 1,522  |
| config loads, a build's generation (1,000 keys in namespaces) | 1  |

## Sizes

Bytes of the artifact: the same on every machine.

| Row | Value |
| --- | ---: |
| the artifact, 1,000 flat keys | 119,583 B |
| the artifact, 10,000 flat keys | 1,242,333 B |
| the artifact, 100,000 flat keys | 12,919,833 B |
| the artifact, 1,000 keys in namespaces | 137,105 B |
| the artifact, 10,000 keys in namespaces | 1,448,407 B |
| the artifact, 100,000 keys in namespaces | 15,294,909 B |
| the artifact, 1,000 keys in one namespace | 131,643 B |
| the artifact, 10,000 keys in one namespace | 1,362,393 B |
| the artifact, 100,000 keys in one namespace | 14,119,893 B |
| the artifact, 1,000 nested keys | 142,799 B |
| the artifact, 10,000 nested keys | 1,526,773 B |
| the artifact, 100,000 nested keys | 16,286,497 B |

## Times

Milliseconds, of one machine at one time: compare them only with figures measured beside them.

| Row | Median | Spread |
| --- | ---: | --- |
| derive, 1,000 flat keys | 5.74 ms | 5.67 ms to 6.02 ms |
| emit, 1,000 flat keys | 4.85 ms | 4.81 ms to 4.95 ms |
| derive, 10,000 flat keys | 62.1 ms | 59.9 ms to 64.4 ms |
| emit, 10,000 flat keys | 57.4 ms | 56.2 ms to 58.2 ms |
| derive, 100,000 flat keys | 742 ms | 728 ms to 759 ms |
| emit, 100,000 flat keys | 623 ms | 618 ms to 629 ms |
| derive, 1,000 keys in namespaces | 4.4 ms | 4.37 ms to 4.41 ms |
| emit, 1,000 keys in namespaces | 5.11 ms | 5.07 ms to 5.13 ms |
| derive, 10,000 keys in namespaces | 52.6 ms | 52.1 ms to 53.8 ms |
| emit, 10,000 keys in namespaces | 60.3 ms | 59.4 ms to 61.8 ms |
| derive, 100,000 keys in namespaces | 725 ms | 711 ms to 743 ms |
| emit, 100,000 keys in namespaces | 649 ms | 645 ms to 654 ms |
| derive, 1,000 keys in one namespace | 4.17 ms | 4.16 ms to 4.25 ms |
| emit, 1,000 keys in one namespace | 4.94 ms | 4.9 ms to 5.05 ms |
| derive, 10,000 keys in one namespace | 51.7 ms | 51.5 ms to 53.8 ms |
| emit, 10,000 keys in one namespace | 60.1 ms | 56.9 ms to 61.5 ms |
| derive, 100,000 keys in one namespace | 700 ms | 681 ms to 733 ms |
| emit, 100,000 keys in one namespace | 674 ms | 660 ms to 718 ms |
| derive, 1,000 nested keys | 4.01 ms | 4 ms to 4.28 ms |
| emit, 1,000 nested keys | 4.99 ms | 4.95 ms to 5.03 ms |
| derive, 10,000 nested keys | 48.8 ms | 48.4 ms to 49.4 ms |
| emit, 10,000 nested keys | 60.8 ms | 60.1 ms to 63.1 ms |
| derive, 100,000 nested keys | 611 ms | 599 ms to 628 ms |
| emit, 100,000 nested keys | 640 ms | 622 ms to 702 ms |
| a build's first generation, on an empty cache, 1,000 keys in namespaces | 996 ms | 980 ms to 999 ms |
| a build's generation, 1,000 keys in namespaces | 788 ms | 785 ms to 794 ms |
| a dev regeneration after a catalogue change, 1,000 keys in namespaces | 539 ms | 530 ms to 541 ms |

## Heap

Bytes of heap retained per dev regeneration, read in a process of their own: they move from process to process and differ from one Node version to another, and a reading near zero, on either side of it, means nothing retained.

| Row | Median | Spread |
| --- | ---: | --- |
| heap retained per dev regeneration, 1,000 keys in namespaces | 852,434 B | 831,915 B to 885,341 B |
