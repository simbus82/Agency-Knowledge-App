# Contributing to 56k Knowledge Hub

First off, thank you for considering contributing to 56k Knowledge Hub! 🎉

Following these guidelines helps to communicate that you respect the time of the developers managing and developing this open source project. In return, they should reciprocate that respect in addressing your issue, assessing changes, and helping you finalize your pull requests.

## 🚀 Quick Start

1. **Fork** the repository
2. **Clone** your fork locally
3. **Install** dependencies: `npm install`
4. **Setup** environment: `npm run setup`
5. **Create** a feature branch: `git checkout -b feature/amazing-feature`
6. **Make** your changes
7. **Test** your changes: `npm test`
8. **Commit** your changes: `git commit -m 'Add amazing feature'`
9. **Push** to your fork: `git push origin feature/amazing-feature`
10. **Open** a Pull Request

## 🎯 Types of Contributions

### 🐛 Bug Reports

Before creating bug reports, please check the existing issues as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples to demonstrate the steps**
- **Describe the behavior you observed after following the steps**
- **Explain which behavior you expected to see instead and why**
- **Include screenshots and animated GIFs** if possible
- **Include your environment details** (OS, browser, Node.js version)

#### Bug Report Template

```markdown
**Bug Description**
A clear and concise description of what the bug is.

**Steps to Reproduce**
1. Go to '...'
2. Click on '...'
3. Scroll down to '...'
4. See error

**Expected Behavior**
A clear description of what you expected to happen.

**Screenshots**
If applicable, add screenshots to help explain your problem.

**Environment**
- OS: [e.g. macOS, Windows, Linux]
- Browser: [e.g. Chrome, Firefox, Safari]
- Node.js Version: [e.g. 18.16.0]
- App Version: [e.g. 1.0.0]

**Additional Context**
Add any other context about the problem here.
```

### ✨ Feature Requests

Feature requests are welcome! Please provide as much detail as possible:

- **Use a clear and descriptive title**
- **Provide a step-by-step description of the suggested enhancement**
- **Provide specific examples to demonstrate the steps**
- **Describe the current behavior and explain which behavior you expected to see instead**
- **Explain why this enhancement would be useful**
- **List some other applications where this enhancement exists**

### 💻 Code Contributions

#### Development Setup

1. **Prerequisites**
   ```bash
   node --version  # Should be 18+
   npm --version   # Should be 8+
   ```

2. **Fork and Clone**
   ```bash
   git clone https://github.com/YOUR-USERNAME/56k-knowledge-hub.git
   cd 56k-knowledge-hub
   ```

3. **Install Dependencies**
   ```bash
   npm install
   ```

4. **Configure Environment**
   ```bash
   npm run setup
   # Follow the setup wizard
   ```

5. **Start Development Servers**
   ```bash
   # Terminal 1 - Backend
   npm run dev
   
   # Terminal 2 - Frontend
   npm run frontend
   ```

#### Development Guidelines

**Code Style:**
- Use 2 spaces for indentation
- Use semicolons
- Use single quotes for strings
- Use camelCase for variables and functions
- Use PascalCase for classes and constructors
- Write descriptive commit messages

**Backend (Node.js):**
- Follow Express.js best practices
- Use async/await instead of callbacks
- Add proper error handling
- Add JSDoc comments for functions
- Use meaningful variable names

**Frontend (JavaScript):**
- Use vanilla JavaScript ES6+
- Follow functional programming patterns
- Add comments for complex logic
- Ensure accessibility compliance
- Test across different browsers

**Database:**
- Write efficient queries
- Use proper indexing
- Add migration scripts for schema changes
- Ensure data validation

#### Commit Message Convention

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Types:**
- `feat:` A new feature
- `fix:` A bug fix
- `docs:` Documentation only changes
- `style:` Changes that do not affect the meaning of the code
- `refactor:` A code change that neither fixes a bug nor adds a feature
- `perf:` A code change that improves performance
- `test:` Adding missing tests or correcting existing tests
- `chore:` Changes to the build process or auxiliary tools

**Examples:**
```
feat(auth): add Google OAuth integration
fix(api): resolve Claude API timeout issues
docs(readme): update installation instructions
style(frontend): improve mobile responsiveness
```

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/AmazingFeature`)
3. **Commit** your changes (`git commit -m 'Add AmazingFeature'`)
4. **Push** to the branch (`git push origin feature/AmazingFeature`)
5. **Open** a Pull Request

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Built with ❤️ by [56k Agency](https://56k.agency)**