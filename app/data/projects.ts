export interface Project {
  slug: string
  title: string
  kind: string
  // One string per paragraph on the project page.
  summary: string[]
  tech: string
  source?: string
  // Path under public/. Leave it out and the tile draws a generated pattern instead.
  image?: string
  imageAlt?: string
  // 'contain' shows the whole image on black, 'cover' fills the tile and crops.
  fit?: 'cover' | 'contain'
  // Keep hard pixel edges when the image itself is pixel art.
  pixelArt?: boolean
}

export const projects: Project[] = [
  {
    slug: 'cuvision',
    title: 'CUVision',
    kind: 'Capstone project: autonomous driving perception',
    summary: [
      'A perception system for autonomous driving, tested in the CARLA simulator and wired together as four ROS 2 Jazzy nodes. I led the perception work and also set up CARLA, the integration pipeline, and object detection.',
      'The drivable-area model, TwinLiteNetPlus-Large, reached 92.9% mIoU at 2.14× the speed of the YOLOPX baseline with 17× fewer parameters. A MobileNetV3-Small classifier covers 252 Canadian traffic sign classes at up to 99.4% top-1 accuracy. A snow augmentation pipeline added 5.17% drivable-area mIoU and 5.93% lane IoU.',
    ],
    tech: 'Python, PyTorch, OpenCV, ROS 2, CARLA',
    source: 'https://github.com/anochronos/cuvision-driving-perception',
    image: '/images/projects/cuvision.jpg',
    imageAlt:
      'A snowy street at night with the drivable area shaded green and boxes drawn around detected cars',
    fit: 'cover',
  },
  {
    slug: 'cognitive-research-platform',
    title: 'Cognitive research platform',
    kind: 'National Research Council Canada',
    summary: [
      'Python tools for human factors research: an orchestration system that runs modular experimental tasks, a survey engine that builds its interface from .ini files, and cognitive tasks with millisecond-accurate input. More than 200 people used them.',
    ],
    tech: 'Python, Tkinter, Pygame',
  },
  {
    slug: 'perk-manager',
    title: 'Perk Manager',
    kind: 'Full-stack web application',
    summary: [
      'Tracks membership perks across 10+ reward programs. Spring Boot REST APIs with JPA and Hibernate, Spring Security for authentication, and HTMX for partial page updates. GitHub Actions deploys to Azure, and 15+ JUnit and Mockito test classes cover it.',
    ],
    tech: 'Java, Spring Boot, HTMX, Azure',
    source: 'https://github.com/JadHamzeh/Perk-Manager',
  },
  {
    slug: 'chip8-emulator',
    title: 'CHIP-8 emulator',
    kind: 'Emulator in C++17',
    summary: [
      'Runs original CHIP-8 games, with SDL2 handling the window and keyboard. The CPU core is separate from the frontend, so tests can run it without opening a window: they load small hand-written ROMs, run a few cycles and check the registers. GitHub Actions builds and tests it on Linux and Windows, and tagged releases publish downloads for both.',
    ],
    tech: 'C++17, SDL2, CMake, GitHub Actions',
    source: 'https://github.com/anochronos/chip8_emu',
    image: '/images/projects/chip8.png',
    imageAlt:
      'A game running in the emulator: rows of pixel-art enemies above a player ship on a black screen',
    fit: 'contain',
    pixelArt: true,
  },
  {
    slug: 'firefighting-drone-swarm',
    title: 'Firefighting drone swarm',
    kind: 'Distributed systems simulation',
    summary: [
      'Drones run their subsystems concurrently and talk over UDP with a custom acknowledgment and timeout protocol. Fault injection and scheduling test how the system behaves when messages are lost, and a Swing dashboard shows its state in real time.',
    ],
    tech: 'Java, UDP sockets, multithreading, Swing',
    source: 'https://github.com/anochronos/firefighting-drone-swarm',
  },
  {
    slug: 'cifar-10',
    title: 'CIFAR-10 object recognition',
    kind: 'Machine learning',
    summary: [
      'A convolutional neural network that classifies CIFAR-10 images at 87% accuracy, with data augmentation and preprocessing added to make it more robust.',
    ],
    tech: 'Python, TensorFlow, NumPy',
  },
]

export function pad(n: number): string {
  return String(n).padStart(2, '0')
}
