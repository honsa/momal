<?php

declare(strict_types=1);

// Simple static file front controller for PHP built-in server.
// In production you'd serve /public directly via nginx/apache.

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

// Basic normalization
$path = str_replace("\0", '', $path);

if ($path === '/' || $path === '') {
    $path = '/index.html';
}

// Block obvious traversal attempts early
if (str_contains($path, '..')) {
    http_response_code(400);
    echo 'Bad request';
    exit;
}

// Execute PHP endpoints under /api (instead of serving source code).
if (str_starts_with($path, '/api/') && str_ends_with($path, '.php')) {
    $file = __DIR__ . $path;
    $real = realpath($file);
    if ($real !== false && str_starts_with($real, realpath(__DIR__) . DIRECTORY_SEPARATOR) && is_file($real)) {
        require $real;
        exit;
    }
}

$file = __DIR__ . $path;
$real = realpath($file);

if ($real !== false && str_starts_with($real, realpath(__DIR__) . DIRECTORY_SEPARATOR) && is_file($real)) {
    $ext = strtolower(pathinfo($real, PATHINFO_EXTENSION));
    $types = [
        'html' => 'text/html; charset=utf-8',
        'js' => 'application/javascript; charset=utf-8',
        'css' => 'text/css; charset=utf-8',
        'png' => 'image/png',
        'svg' => 'image/svg+xml',
        'json' => 'application/json; charset=utf-8',
    ];
    if (isset($types[$ext])) {
        header('Content-Type: ' . $types[$ext]);
    }
    readfile($real);
    exit;
}

http_response_code(404);
echo 'Not found';
