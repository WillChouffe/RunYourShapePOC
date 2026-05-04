"""
Shape skeleton definitions for pattern-based route matching.

Each shape is defined by its structural features rather than exact coordinates:
- Segments with relative angles and length ratios
- Arcs with curvature direction and approximate angles
- Constraints on symmetry, closure, etc.
"""
from dataclasses import dataclass, field
from typing import List, Literal, Optional, Tuple
from enum import Enum
import math


class PrimitiveType(Enum):
    """Type of geometric primitive."""
    SEGMENT = "segment"
    ARC = "arc"


class CurvatureDirection(Enum):
    """Direction of arc curvature."""
    LEFT = "left"      # Curves to the left
    RIGHT = "right"    # Curves to the right
    ANY = "any"        # Either direction acceptable


@dataclass
class SkeletonPrimitive:
    """A single primitive in a shape skeleton."""
    type: PrimitiveType
    # Relative length (1.0 = reference length, others are ratios)
    length_ratio: float = 1.0
    length_tolerance: float = 0.5  # ±50% by default
    
    # For segments: angle relative to previous primitive (degrees)
    # For arcs: total arc angle (degrees)
    angle: float = 0.0
    angle_tolerance: float = 30.0  # ±30° by default
    
    # For arcs only
    curvature: CurvatureDirection = CurvatureDirection.ANY
    
    # Optional: name for debugging
    name: str = ""


@dataclass
class ShapeSkeleton:
    """
    Abstract definition of a shape as a sequence of primitives.
    
    The shape is defined by:
    - A sequence of primitives (segments and arcs)
    - Whether the shape is closed (returns to start)
    - Symmetry constraints
    """
    name: str
    primitives: List[SkeletonPrimitive]
    closed: bool = True  # Most running routes are loops
    
    # Symmetry: if True, shape should be roughly symmetric
    symmetric: bool = False
    symmetry_axis: Literal["vertical", "horizontal", "none"] = "none"
    
    # Total angle sum constraint (for closed shapes, should be ~360°)
    expected_total_turn: float = 360.0
    turn_tolerance: float = 60.0
    
    # Minimum/maximum number of key vertices
    min_vertices: int = 3
    max_vertices: int = 20
    
    def __post_init__(self):
        """Calculate derived properties."""
        self.num_primitives = len(self.primitives)


# =============================================================================
# PREDEFINED SHAPE SKELETONS
# =============================================================================

def create_heart_skeleton() -> ShapeSkeleton:
    """
    Heart shape: two descending segments meeting at a point,
    two arcs curving outward at the top.
    
    Structure:
    - Start at bottom point (the "tip" of the heart)
    - Go up-left with a segment
    - Arc curving left (top-left lobe)
    - Arc curving right (top-right lobe) 
    - Go down-right with a segment back to start
    
    Key feature: the angle at the bottom can vary widely
    (acute = tall heart, obtuse = wide heart)
    """
    return ShapeSkeleton(
        name="heart",
        primitives=[
            # Left ascending segment (from tip going up-left)
            SkeletonPrimitive(
                type=PrimitiveType.SEGMENT,
                length_ratio=1.0,
                length_tolerance=0.4,
                angle=45,  # Roughly 45° from vertical
                angle_tolerance=40,  # Can be 5° to 85°
                name="left_ascent"
            ),
            # Top-left arc (curves outward/left)
            SkeletonPrimitive(
                type=PrimitiveType.ARC,
                length_ratio=0.8,
                length_tolerance=0.5,
                angle=180,  # Half-circle-ish
                angle_tolerance=60,
                curvature=CurvatureDirection.LEFT,
                name="left_lobe"
            ),
            # Top-right arc (curves outward/right)
            SkeletonPrimitive(
                type=PrimitiveType.ARC,
                length_ratio=0.8,
                length_tolerance=0.5,
                angle=180,
                angle_tolerance=60,
                curvature=CurvatureDirection.RIGHT,
                name="right_lobe"
            ),
            # Right descending segment (back to tip)
            SkeletonPrimitive(
                type=PrimitiveType.SEGMENT,
                length_ratio=1.0,
                length_tolerance=0.4,
                angle=45,
                angle_tolerance=40,
                name="right_descent"
            ),
        ],
        closed=True,
        symmetric=True,
        symmetry_axis="vertical",
        min_vertices=4,
        max_vertices=12,
    )


def create_star_skeleton(num_points: int = 5) -> ShapeSkeleton:
    """
    Star shape: alternating outward and inward vertices.
    
    A 5-pointed star has 10 segments total:
    - 5 going outward to points
    - 5 going inward to valleys
    
    Key feature: the ratio between point length and valley depth
    can vary (sharp vs blunt star)
    """
    primitives = []
    
    # Angle between consecutive segments
    # For a 5-pointed star: external angle alternates
    outer_angle = 180 - (180 / num_points)  # Angle at points (sharp turn)
    inner_angle = 180 + (180 / num_points)  # Angle at valleys (gentle turn)
    
    for i in range(num_points * 2):
        is_outward = (i % 2 == 0)
        primitives.append(
            SkeletonPrimitive(
                type=PrimitiveType.SEGMENT,
                length_ratio=1.0 if is_outward else 0.6,  # Points longer than valleys
                length_tolerance=0.5,
                angle=outer_angle if is_outward else inner_angle,
                angle_tolerance=35,
                name=f"{'point' if is_outward else 'valley'}_{i//2}"
            )
        )
    
    return ShapeSkeleton(
        name=f"star_{num_points}",
        primitives=primitives,
        closed=True,
        symmetric=True,
        symmetry_axis="none",  # Rotational symmetry
        min_vertices=num_points * 2,
        max_vertices=num_points * 2 + 4,
    )


def create_circle_skeleton(num_arcs: int = 4) -> ShapeSkeleton:
    """
    Circle shape: sequence of arcs curving in the same direction.
    
    Key feature: very tolerant on the number of arcs and their
    individual curvature, as long as total turn is ~360°
    """
    arc_angle = 360 / num_arcs
    
    primitives = [
        SkeletonPrimitive(
            type=PrimitiveType.ARC,
            length_ratio=1.0,
            length_tolerance=0.6,
            angle=arc_angle,
            angle_tolerance=arc_angle * 0.5,  # Very tolerant
            curvature=CurvatureDirection.RIGHT,  # Consistent direction
            name=f"arc_{i}"
        )
        for i in range(num_arcs)
    ]
    
    return ShapeSkeleton(
        name="circle",
        primitives=primitives,
        closed=True,
        symmetric=True,
        symmetry_axis="none",
        expected_total_turn=360.0,
        turn_tolerance=90.0,  # Very tolerant for circles
        min_vertices=4,
        max_vertices=16,
    )


def create_lightning_skeleton() -> ShapeSkeleton:
    """
    Lightning bolt: zigzag pattern with sharp angles.
    
    Structure: series of segments with alternating sharp turns
    """
    return ShapeSkeleton(
        name="lightning",
        primitives=[
            SkeletonPrimitive(
                type=PrimitiveType.SEGMENT,
                length_ratio=1.0,
                angle=30,
                angle_tolerance=25,
                name="bolt_1"
            ),
            SkeletonPrimitive(
                type=PrimitiveType.SEGMENT,
                length_ratio=0.6,
                angle=-120,  # Sharp turn back
                angle_tolerance=30,
                name="zag_1"
            ),
            SkeletonPrimitive(
                type=PrimitiveType.SEGMENT,
                length_ratio=1.2,
                angle=120,  # Sharp turn forward
                angle_tolerance=30,
                name="bolt_2"
            ),
            SkeletonPrimitive(
                type=PrimitiveType.SEGMENT,
                length_ratio=0.5,
                angle=-120,
                angle_tolerance=30,
                name="zag_2"
            ),
            SkeletonPrimitive(
                type=PrimitiveType.SEGMENT,
                length_ratio=1.0,
                angle=100,
                angle_tolerance=35,
                name="bolt_3"
            ),
        ],
        closed=False,  # Lightning doesn't close
        symmetric=False,
        min_vertices=4,
        max_vertices=10,
    )


# Registry of available skeletons
SHAPE_SKELETONS = {
    "heart": create_heart_skeleton,
    "star": lambda: create_star_skeleton(5),
    "circle": lambda: create_circle_skeleton(4),
    "lightning": create_lightning_skeleton,
}


def get_skeleton_for_shape(shape_name: str) -> Optional[ShapeSkeleton]:
    """
    Get the skeleton definition for a shape.
    
    Args:
        shape_name: Name of the shape (heart, star, circle, lightning)
        
    Returns:
        ShapeSkeleton or None if not found
    """
    # Try exact match first
    if shape_name in SHAPE_SKELETONS:
        return SHAPE_SKELETONS[shape_name]()
    
    # Try to extract base name (e.g., "star_abc123" -> "star")
    base_name = shape_name.split("_")[0].lower()
    if base_name in SHAPE_SKELETONS:
        return SHAPE_SKELETONS[base_name]()
    
    return None


