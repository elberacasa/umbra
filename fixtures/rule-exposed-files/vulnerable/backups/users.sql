-- MySQL dump 10.13  Distrib 8.0.32, for Linux (x86_64)
-- Host: localhost    Database: appdb
-- ------------------------------------------------------
-- Server version	8.0.32

CREATE TABLE `users` (
  `id` int NOT NULL,
  `email` varchar(255) DEFAULT NULL
);

INSERT INTO `users` VALUES (1,'admin@example.com');
-- Dump completed on 2026-01-01  0:00:00
