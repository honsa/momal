<?php

declare(strict_types=1);

namespace Momal\Domain;

final class HighscoreStore
{
    public function __construct(
        private readonly string $filePath
    ) {
        $dir = \dirname($this->filePath);
        if (!\is_dir($dir)) {
            \mkdir($dir, 0777, true);
        }
        if (!\file_exists($this->filePath)) {
            \file_put_contents($this->filePath, \json_encode([], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        }
    }

    /**
     * @return array<int, array{name:string, points:int, updatedAt:int}>
     */
    public function top(int $limit = 20): array
    {
        $all = $this->readAll();
        \usort($all, static fn($a, $b) => ($b['points'] <=> $a['points']) ?: ($b['updatedAt'] <=> $a['updatedAt']));
        return \array_slice($all, 0, $limit);
    }

    public function bump(string $name, int $points): void
    {
        $name = \trim($name);
        if ($name === '') {
            return;
        }

        $all = $this->readAll();
        $now = \time();
        $found = false;

        foreach ($all as &$entry) {
            if (\mb_strtolower($entry['name']) === \mb_strtolower($name)) {
                $entry['points'] = \max((int)$entry['points'], $points);
                $entry['updatedAt'] = $now;
                $found = true;
                break;
            }
        }
        unset($entry);

        if (!$found) {
            $all[] = [
                'name' => $name,
                'points' => $points,
                'updatedAt' => $now,
            ];
        }

        $this->writeAll($all);
    }

    /**
     * @return array<int, array{name:string, points:int, updatedAt:int}>
     */
    private function readAll(): array
    {
        $raw = @\file_get_contents($this->filePath);
        if ($raw === false || $raw === '') {
            return [];
        }

        $decoded = \json_decode($raw, true);
        if (!\is_array($decoded)) {
            return [];
        }

        $out = [];
        foreach ($decoded as $entry) {
            if (!\is_array($entry)) {
                continue;
            }
            $name = (string)($entry['name'] ?? '');
            $points = (int)($entry['points'] ?? 0);
            $updatedAt = (int)($entry['updatedAt'] ?? 0);
            if (\trim($name) === '') {
                continue;
            }
            $out[] = ['name' => $name, 'points' => $points, 'updatedAt' => $updatedAt];
        }
        return $out;
    }

    /** @param array<int, array{name:string, points:int, updatedAt:int}> $all */
    private function writeAll(array $all): void
    {
        // simple file lock to avoid concurrent writes
        $fp = \fopen($this->filePath, 'c+');
        if ($fp === false) {
            return;
        }

        try {
            if (!\flock($fp, LOCK_EX)) {
                return;
            }
            \ftruncate($fp, 0);
            \rewind($fp);

            $json = \json_encode($all, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
            if ($json === false) {
                $json = '[]';
            }

            \fwrite($fp, $json);
        } finally {
            @\flock($fp, LOCK_UN);
            @\fclose($fp);
        }
    }
}
