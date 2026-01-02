<?php

declare(strict_types=1);

namespace Momal\Domain;

/**
 * Stores highscores per room.
 *
 * Data model (JSON):
 * {
 *   "ROOMID": [ {"name": "Alice", "points": 42, "updatedAt": 1700000000}, ... ],
 *   "OTHER":  [ ... ]
 * }
 */
final class RoomHighscoreStore
{
    public function __construct(
        private readonly string $filePath
    ) {
        $dir = \dirname($this->filePath);
        if (!\is_dir($dir)) {
            \mkdir($dir, 0777, true);
        }
        if (!\file_exists($this->filePath)) {
            \file_put_contents($this->filePath, \json_encode(new \stdClass(), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        }
    }

    /**
     * @return array<int, array{name:string, points:int, updatedAt:int}>
     */
    public function top(string $roomId, int $limit = 20): array
    {
        $roomId = $this->normalizeRoomId($roomId);
        if ($roomId === '') {
            return [];
        }

        $all = $this->readRoom($roomId);
        \usort($all, static fn ($a, $b) => ($b['points'] <=> $a['points']) ?: ($b['updatedAt'] <=> $a['updatedAt']));

        return \array_slice($all, 0, $limit);
    }

    public function bump(string $roomId, string $name, int $points): void
    {
        $roomId = $this->normalizeRoomId($roomId);
        $name = \trim($name);

        if ($roomId === '' || $name === '') {
            return;
        }

        $db = $this->readAllRooms();
        $now = \time();

        $list = $db[$roomId] ?? [];
        if (!\is_array($list)) {
            $list = [];
        }

        $found = false;
        foreach ($list as &$entry) {
            if (!\is_array($entry)) {
                continue;
            }

            $entryName = (string)$entry['name'];
            if (\mb_strtolower($entryName) === \mb_strtolower($name)) {
                $entry['name'] = $name;
                $entry['points'] = \max((int)$entry['points'], $points);
                $entry['updatedAt'] = $now;
                $found = true;
                break;
            }
        }
        unset($entry);

        if (!$found) {
            $list[] = [
                'name' => $name,
                'points' => $points,
                'updatedAt' => $now,
            ];
        }

        $db[$roomId] = $this->sanitizeList($list);
        $this->writeAllRooms($db);
    }

    private function normalizeRoomId(string $roomId): string
    {
        $roomId = \strtoupper(\preg_replace('/[^A-Za-z0-9]/', '', $roomId) ?? '');

        return \substr($roomId, 0, 6);
    }

    /**
     * @return array<string, array<int, array{name:string, points:int, updatedAt:int}>>
     */
    private function readAllRooms(): array
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
        foreach ($decoded as $roomId => $list) {
            if (!\is_string($roomId)) {
                continue;
            }
            if (!\is_array($list)) {
                continue;
            }
            $out[$this->normalizeRoomId($roomId)] = $this->sanitizeList($list);
        }

        return $out;
    }

    /** @return array<int, array{name:string, points:int, updatedAt:int}> */
    private function readRoom(string $roomId): array
    {
        $db = $this->readAllRooms();

        return $db[$roomId] ?? [];
    }

    /**
     * @param array<int, mixed> $list
     * @return array<int, array{name:string, points:int, updatedAt:int}>
     */
    private function sanitizeList(array $list): array
    {
        $out = [];
        foreach ($list as $entry) {
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

    /** @param array<string, array<int, array{name:string, points:int, updatedAt:int}>> $db */
    private function writeAllRooms(array $db): void
    {
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

            $json = \json_encode($db, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
            if ($json === false) {
                $json = '{}';
            }

            \fwrite($fp, $json);
        } finally {
            @\flock($fp, LOCK_UN);
            @\fclose($fp);
        }
    }
}
